import React from 'react';
import * as d3 from 'd3';

import Paper from 'material-ui/Paper';
import Dots from './Dots';

export default class ActiveBackgound extends React.Component {

    constructor(props) {
        super(props);
        let data = [];
        const colours = ['#E24e42', '#e9b000','#EB6E80', '#008F95'];
        let x, y, dx, dy;
        for (let i = 0; i < 100; i++){
                x = Math.random()*150-25;
                y =   Math.random()*90;
                dy = (50-x)/150;
                dx = (y-50)/90;
                data = data.concat(
                    {x: x, y:y, vx: 20*dx, vy: 20*dy , colour: colours[i % 4], size: Math.random()* 7 +3 + 'px'});
        }
        this.state =  {
            width: 600,
            height: 600,
            data:  data
        };
    }

    updatePos(){
        const data = this.state.data;
        const cx = 50;
        const cy = 50;
        let newdata = [];
        data.pop();
        data.forEach((d, i)=>{
            let fx = 0;
            let fy = 0;
            let dt = 0.01;

            let f = parseFloat(4)
                / Math.sqrt(Math.pow((d.x - cx),2) + Math.pow((d.y - cy),2));

            fx = fx + f * (cx - d.x);
            fy= fy + f * (cy - d.y);


            let x = d.x + d.vx * dt + fx * dt * dt;
            let y = d.y + d.vy * dt + fy * dt * dt;
            let vx =  d.vx + fx * dt;
            let vy =  d.vy + fy * dt;

            newdata = newdata.concat({x: x, y:y, vx: vx, vy: vy, colour: d.colour, size: d.size})
        });
        newdata = newdata.concat({x: 50, y:50, vx: 0, vy: 0, colour: 'black', size: '15px'});
        this.setState({data: newdata})
    }
    componentWillUnmount(){
        if (window.activebt) {
            window.clearInterval(window.activebt)
        }
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
        window.activebt = setTimeout(this.updatePos.bind(this), 1);
        return (
            <svg className="introview" viewBox="0 -5 600 600" id={'chart'} width={this.state.width} height={this.props.height}>
                <g transform={transform}>
                    <Dots data={this.state.data} x={x} y={y}/>
                </g>
            </svg>
        );
    }
}
