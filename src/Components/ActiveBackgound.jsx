import React from 'react';
import * as d3 from 'd3';

import Paper from 'material-ui/Paper';
import Dots from './Dots';

export default class ActiveBackgound extends React.Component {

    constructor(props) {
        super(props);
        let achievements = [{date: 'September 1st, 2017', desc: 'First day of University', colour: 'blue', size: '6px'}];
        let data = [];
        const colours = ['#E24e42', '#e9b000','#EB6E80', '#008F95'];
        for (let i = 0; i < 10; i++){
            if (i < achievements.length -1){
                data = data.concat(
                    {x: Math.random()*90, y: Math.random()*90, vx: 0, vy: 0, colour: colours[i % 4], size: achievements[i].size});
            }
            else {
                data = data.concat(
                    {x: Math.random()*90, y: Math.random()*90, vx: 0, vy: 0, colour: colours[i % 4], size: Math.floor(Math.random() * 15) + 15 + 'px'});
            }
        }
        this.state =  {
            width: 600,
            height: 600,
            data:  data
        };
    }

    updatePos(){
        const data = this.state.data;
        const newdata = data.map((d, i)=>{
            let fx = 0;
            let fy = 0;
            let dt = 0.005;
            data.forEach((d2, j) =>{
                if (d != d2){
                    let f = parseFloat(d2.size.replace('px', ''))
                        / Math.sqrt(Math.pow((d.x - d2.x),2) + Math.pow((d.y - d2.y),2));
                    fx = fx + f * (d2.x - d.x);
                    fy= fy + f * (d2.y - d.y);
                }
            });
            let x = d.x + d.vx * dt + fx * dt * dt;
            let y = d.y + d.vy * dt + fy * dt * dt;
            let vx =  d.vx + fx * dt;
            let vy =  d.vy + fy * dt; return {x: x, y:y, vx: vx, vy: vy, colour: d.colour, size: d.size}
        });
        this.setState({data: newdata})
    }
    render() {
        const data = this.state.data;
        var margin = {top:50, right: 50, bottom: 50, left: 50},
            w = this.state.width - (margin.left + margin.right),
            h = this.state.height - (margin.top + margin.bottom);

        const x = d3.scaleLinear()
            .domain([0,100])
            .rangeRound([0, w]);

        const y = d3.scaleLinear()
            .domain([0,100]).range([h, 0]);

        var yAxis = d3.axisLeft(y).ticks(5);

        var xAxis = d3.axisBottom(x)
            .tickValues(this.state.data.map(function(d,i){
                if(i>0)
                    return d.x;
            }).splice(1))
            .ticks(4);

        var yGrid = d3.axisLeft(y)
            .ticks(5)
            .tickSize(-w, 0, 0)
            .tickFormat("");


        var transform= 'translate(' + margin.left + ',' + margin.top + ')';
        setTimeout(this.updatePos.bind(this), 1);
        return (
            <svg className="introview" viewBox="0 -5 600 600" id={'chart'} width={this.state.width} height={this.props.height}>
                <g transform={transform}>
                    <Dots data={this.state.data} x={x} y={y}/>
                </g>
            </svg>
        );
    }
}

var Axis=React.createClass({
    propTypes: {
        h:React.PropTypes.number,
        axis:React.PropTypes.func,
        axisType:React.PropTypes.oneOf(['x','y'])

    },

    componentDidUpdate: function () { this.renderAxis(); },
    componentDidMount: function () { this.renderAxis(); },
    renderAxis: function () {
        var node = ReactDOM.findDOMNode(this);
        d3.select(node).call(this.props.axis);

    },
    render: function () {

        var translate = "translate(0,"+(this.props.h)+")";

        return (
            <g className="axis" transform={this.props.axisType=='x'?translate:""} >
            </g>
        );
    }

});

var Grid=React.createClass({
    propTypes: {
        h:React.PropTypes.number,
        grid:React.PropTypes.func,
        gridType:React.PropTypes.oneOf(['x','y'])
    },

    componentDidUpdate: function () { this.renderGrid(); },
    componentDidMount: function () { this.renderGrid(); },
    renderGrid: function () {
        var node = ReactDOM.findDOMNode(this);
        d3.select(node).call(this.props.grid);

    },
    render: function () {
        var translate = "translate(0,"+(this.props.h)+")";
        return (
            <g className="y-grid" transform={this.props.gridType=='x'?translate:""}>
            </g>
        );
    }

});
