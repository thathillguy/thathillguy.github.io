import React from 'react';


export default class Chart extends React.Component {

    constructor(props){
        super(props);
    }
    render() {
        //remove last & first point
        var data = this.props.data;
        var circles = data.map((d, i) => {

            return (<circle className="dot" r={d.size} cx={this.props.x(d.x)} cy={this.props.y(d.y)} fill={d.colour}
                            stroke="black" strokeWidth="1px" key={i}/>)
        });
        return (
            <g>
                {circles}
            </g>
        )
    }
}