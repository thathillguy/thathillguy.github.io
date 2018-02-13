import React from 'react';
import * as d3 from 'd3';

import Paper from 'material-ui/Paper';
import Dots from './Dots';

export default class ActiveBackgound extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            height: 500,
            width: 500,
            data: [{x: 50, y:50, vx: 0, vy: 0 , colour:1, size: Math.random()* 7 +3 + 'px'}]
        }
    }
    componentWillUnmount(){
    }
    updatePos(){

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


    var transform= 'translate(' + margin.left + ',' + margin.top + ')';
    window.activebt = window.requestAnimationFrame(this.updatePos.bind(this));
        return (
            <svg className="vs view" viewBox="0 -5 600 600" id={'chart'} width={this.state.width} height={this.props.height}>
                <g transform={transform}>
                    <Dots data={this.state.data} x={x} y={y}/>
                </g>
            </svg>
        )
    }
}
